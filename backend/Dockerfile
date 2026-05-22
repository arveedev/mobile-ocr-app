# Use official Python image
FROM python:3.9

# Set the working directory
WORKDIR /code

# Copy the requirements file and install them
COPY ./requirements.txt /code/requirements.txt
RUN pip install --no-cache-dir -r /code/requirements.txt

# Copy our actual Python code into the cloud
COPY . /code

# Open the port and run the server
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860"]